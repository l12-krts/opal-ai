// A persistent Chromium controlled through a tiny HTTP API on 127.0.0.1 (inside the container
// only). The Opal server talks to it with `docker exec opal-browser '<json>'`, so no port is
// ever published to the host.
import { createServer } from "node:http";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { chromium } from "playwright";

const PORT = Number(process.env.OPAL_BROWSER_PORT || 7777);
const VIEWPORT = { width: 1280, height: 800 };

let browser;
let context;
let page;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.");
}

async function blocked(url) {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return u.protocol !== "about:" && u.protocol !== "data:" && u.protocol !== "blob:";
    if (u.hostname === "localhost" || u.hostname.endsWith(".internal") || u.hostname.endsWith(".local")) return true;
    const { address } = await lookup(u.hostname);
    return isPrivateIp(address);
  } catch {
    return true;
  }
}

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  }
  if (!context) {
    context = await browser.newContext({ viewport: VIEWPORT, locale: "el-GR", acceptDownloads: false });
    // Keep the sandbox browser off private networks (host, LAN, cloud metadata).
    await context.route("**/*", async (route) => {
      if (await blocked(route.request().url())) return route.abort("blockedbyclient");
      return route.continue();
    });
  }
  page = await context.newPage();
  return page;
}

async function snapshot(p, { screenshot = true } = {}) {
  const title = await p.title().catch(() => "");
  const url = p.url();
  const text = await p
    .evaluate(() => {
      const t = document.body ? document.body.innerText : "";
      return t.replace(/\n{3,}/g, "\n\n").slice(0, 12000);
    })
    .catch(() => "");
  const links = await p
    .evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .slice(0, 60)
        .map((a) => ({ text: (a.innerText || "").trim().slice(0, 80), href: a.href }))
        .filter((l) => l.text),
    )
    .catch(() => []);
  const shot = screenshot ? (await p.screenshot({ type: "jpeg", quality: 60 })).toString("base64") : undefined;
  return { url, title, text, links, screenshot: shot };
}

async function handle(cmd) {
  const p = await ensurePage();
  const timeout = Math.min(Number(cmd.timeout) || 20000, 45000);
  switch (cmd.action) {
    case "goto":
      if (await blocked(cmd.url)) throw new Error("That address is blocked inside the sandbox");
      await p.goto(cmd.url, { waitUntil: "domcontentloaded", timeout });
      await p.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      return snapshot(p);
    case "click":
      if (cmd.selector) await p.click(cmd.selector, { timeout });
      else if (cmd.text) await p.getByText(cmd.text, { exact: false }).first().click({ timeout });
      else throw new Error("click needs selector or text");
      await p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      return snapshot(p);
    case "type":
      await p.fill(cmd.selector, String(cmd.value ?? ""), { timeout });
      if (cmd.submit) await p.press(cmd.selector, "Enter");
      await p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      return snapshot(p);
    case "press":
      await p.keyboard.press(String(cmd.key || "Enter"));
      return snapshot(p);
    case "scroll":
      await p.mouse.wheel(0, Number(cmd.dy) || 600);
      await p.waitForTimeout(250);
      return snapshot(p);
    case "back":
      await p.goBack({ timeout }).catch(() => {});
      return snapshot(p);
    case "read":
      return snapshot(p, { screenshot: false });
    case "screenshot":
      return snapshot(p);
    default:
      throw new Error(`Unknown action ${cmd.action}`);
  }
}

let queue = Promise.resolve();

createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on("end", () => {
    // One command at a time per browser.
    queue = queue.then(async () => {
      try {
        const out = await handle(JSON.parse(body));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, ...out }));
      } catch (err) {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: false, error: String(err?.message || err).slice(0, 500) }));
      }
    });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`browser server on ${PORT}`));
