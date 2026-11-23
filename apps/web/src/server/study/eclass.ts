// Open eClass (GUnet), the LMS most Greek universities run. Generic: the user adds their
// institution's eClass URL and username, and stores the password in the vault as
// ECLASS_PASSWORD. Uses the standard web pages (login form, portfolio, documents, announcements).
//
// Institutions that only allow single sign-on (CAS/Shibboleth) can't use this direct login;
// for those, agents sign in through their sandbox browser with the vault password instead.
import * as cheerio from "cheerio";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { studySource } from "../db/schema";
import { safeFetch } from "../net";
import { readSecret } from "../vault";
import { htmlToText } from "../ai/tools/web";
import type { StudyItem, StudyReadResult, StudySource } from "./types";

const CHUNK = 12000;

type Session = { base: string; cookie: string; at: number };
const g = globalThis as unknown as { __eclass?: Map<string, Session> };
const sessions = (g.__eclass ??= new Map());

export class EclassSetupError extends Error {}

async function config(userId: string) {
  const [row] = await db
    .select()
    .from(studySource)
    .where(and(eq(studySource.userId, userId), eq(studySource.kind, "eclass")))
    .limit(1);
  if (!row?.config.baseUrl || !row.config.username) {
    throw new EclassSetupError("eClass is not set up. Add your eClass URL and username on the Study page.");
  }
  return { base: row.config.baseUrl.replace(/\/+$/, ""), username: row.config.username, secretName: row.config.secretName || "ECLASS_PASSWORD" };
}

function mergeCookies(prev: string, res: Response): string {
  const jar = new Map(prev.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c] as const));
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const pair = c.split(";")[0];
    jar.set(pair.split("=")[0], pair);
  }
  return [...jar.values()].join("; ");
}

async function login(userId: string): Promise<Session> {
  const existing = sessions.get(userId);
  if (existing && Date.now() - existing.at < 20 * 60_000) return existing;
  const { base, username, secretName } = await config(userId);
  const password = await readSecret(userId, secretName);
  if (!password) throw new EclassSetupError(`Missing vault secret ${secretName}. Ask the user to save it with request_secret.`);

  const first = await safeFetch(`${base}/`, { timeoutMs: 15000 });
  let cookie = mergeCookies("", first.res);
  const body = new URLSearchParams({ uname: username, pass: password, submit: "Είσοδος" });
  const res = await safeFetch(`${base}/`, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    timeoutMs: 15000,
  });
  cookie = mergeCookies(cookie, res.res);
  const portfolio = await safeFetch(`${base}/main/portfolio.php`, { headers: { cookie }, timeoutMs: 15000 });
  const html = portfolio.body.toString("utf8");
  if (!/logout|αποσύνδεση/i.test(html)) throw new EclassSetupError("eClass login failed. Check the URL, username and saved password.");
  const s = { base, cookie, at: Date.now() };
  sessions.set(userId, s);
  return s;
}

async function get(userId: string, path: string) {
  const s = await login(userId);
  const url = new URL(path, `${s.base}/`).toString();
  // Compare origins, not string prefixes ("eclass.uni.gr.evil.com" must not pass).
  if (new URL(url).origin !== new URL(s.base).origin) throw new Error("Outside the configured eClass site");
  return safeFetch(url, { headers: { cookie: s.cookie }, timeoutMs: 30000, maxBytes: 40 * 1024 * 1024 });
}

const COURSE_RE = /\/courses\/([A-Za-z0-9_-]+)\/?/;

export const eclassSource: StudySource = {
  id: "eclass",
  name: "Open eClass",
  description: "Your university's eClass: courses, documents and announcements.",

  async browse(userId, ref) {
    if (!ref) {
      const { body } = await get(userId, "/main/portfolio.php");
      const $ = cheerio.load(body.toString("utf8"));
      const courses = new Map<string, StudyItem>();
      $("a[href]").each((_, a) => {
        const href = $(a).attr("href") ?? "";
        const m = COURSE_RE.exec(href);
        const title = $(a).text().trim();
        if (m && title && !courses.has(m[1])) {
          courses.set(m[1], { id: `eclass:course:${m[1]}`, title, subtitle: m[1], kind: "course" });
        }
      });
      return [...courses.values()];
    }
    const course = /^eclass:course:([A-Za-z0-9_-]+)$/.exec(ref)?.[1];
    if (!course) return [];
    const [docs, ann] = await Promise.allSettled([
      get(userId, `/modules/document/index.php?course=${course}`),
      get(userId, `/modules/announcements/index.php?course=${course}`),
    ]);
    const items: StudyItem[] = [];
    if (docs.status === "fulfilled") {
      const $ = cheerio.load(docs.value.body.toString("utf8"));
      $("a[href]").each((_, a) => {
        const href = $(a).attr("href") ?? "";
        if (href.includes("/modules/document/file.php/") || /openDir=/.test(href)) {
          const title = $(a).text().trim();
          if (!title) return;
          const isDir = /openDir=/.test(href);
          items.push({
            id: isDir ? `eclass:dir:${course}:${new URL(href, "https://x").searchParams.get("openDir")}` : `eclass:file:${href}`,
            title,
            kind: isDir ? "course" : "document",
            format: /\.pdf(\?|$)/i.test(href) ? "pdf" : "other",
          });
        }
      });
    }
    if (ann.status === "fulfilled") {
      const { text } = htmlToText(ann.value.body.toString("utf8"));
      items.push({ id: `eclass:announcements:${course}`, title: "Announcements", subtitle: text.slice(0, 120), kind: "announcement" });
    }
    return items;
  },

  async search(userId, query) {
    const courses = await this.browse!(userId);
    const q = query.toLowerCase();
    return courses.filter((c) => c.title.toLowerCase().includes(q) || c.subtitle?.toLowerCase().includes(q)).slice(0, 20);
  },

  async read(userId, ref, opts = {}): Promise<StudyReadResult> {
    const offset = Math.max(0, opts.offset ?? 0);
    if (ref.startsWith("eclass:announcements:")) {
      const course = ref.split(":")[2];
      const { body } = await get(userId, `/modules/announcements/index.php?course=${encodeURIComponent(course)}`);
      const { text } = htmlToText(body.toString("utf8"));
      return { title: "Announcements", text: text.slice(offset, offset + CHUNK), offset, total: text.length };
    }
    if (ref.startsWith("eclass:dir:")) {
      const [, , course, dir] = ref.split(":");
      const { body } = await get(userId, `/modules/document/index.php?course=${encodeURIComponent(course)}&openDir=${encodeURIComponent(dir)}`);
      const { text } = htmlToText(body.toString("utf8"));
      return { title: dir, text: text.slice(0, CHUNK), offset: 0, total: text.length };
    }
    if (ref.startsWith("eclass:file:")) {
      const href = ref.slice("eclass:file:".length);
      const { res, body, finalUrl } = await get(userId, href);
      const type = res.headers.get("content-type") ?? "";
      let text = "";
      if (type.includes("pdf") || /\.pdf(\?|$)/i.test(href)) {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(body));
        text = String((await extractText(pdf, { mergePages: true })).text);
      } else if (type.includes("html")) {
        text = htmlToText(body.toString("utf8")).text;
      } else if (type.startsWith("text/")) {
        text = body.toString("utf8");
      } else {
        text = `This file type (${type || "unknown"}) can't be read as text yet. Open it in the sandbox browser instead.`;
      }
      return { title: decodeURIComponent(href.split("/").pop() ?? "Document"), text: text.slice(offset, offset + CHUNK), offset, total: text.length, url: finalUrl };
    }
    throw new Error("Unknown eClass reference");
  },
};
