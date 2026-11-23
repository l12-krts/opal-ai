import { tool } from "ai";
import * as cheerio from "cheerio";
import { SafeSearchType, SearchTimeType, search, searchNews } from "duck-duck-scrape";
import { z } from "zod";
import { safeFetch } from "../../net";
import { env } from "../../env";
import type { RunContext } from "../context";

export function htmlToText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer, header form").remove();
  const title = $("title").first().text().trim();
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const text = root
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
  return { title, text };
}

// ─── Web search (SearXNG, DuckDuckGo as fallback) ─────────────────────────────

type SearchHit = { title: string; url: string; snippet: string; source: string; age?: string };
type SearchOut = { ok: true; query: string; kind: "web" | "news"; results: SearchHit[]; note?: string } | { ok: false; error: string };

const TIME: Record<string, SearchTimeType> = {
  any: SearchTimeType.ALL,
  day: SearchTimeType.DAY,
  week: SearchTimeType.WEEK,
  month: SearchTimeType.MONTH,
  year: SearchTimeType.YEAR,
};

// DuckDuckGo turns away bursts of requests, so searches are spaced out (shared by every chat
// on this server) and repeated queries are answered from a short cache.
const GAP_MS = 1500;
const CACHE_MS = 10 * 60_000;
const DUCK_FALLBACK_MS = 5000;
let nextSlot = 0;
const cache = new Map<string, { at: number; value: SearchOut }>();

async function waitTurn() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + GAP_MS;
  if (start > now) await new Promise((r) => setTimeout(r, start - now));
}

/** Snippets come with <b> tags and entities. */
function plain(html: string) {
  return cheerio.load(html, null, false).text().replace(/\s+/g, " ").trim();
}

const HTTP = { open_timeout: 8000, response_timeout: 10_000, read_timeout: 10_000 };

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * SearXNG asks several engines at once (Google, Bing, Brave, Wikipedia…), so one engine
 * turning searches away doesn't stop search. Returns null when it isn't configured or reachable.
 */
async function searxng(query: string, kind: "web" | "news", time: string): Promise<{ hits: SearchHit[]; blocked: number } | null> {
  const base = env().SEARXNG_URL;
  if (!base || base === "off") return null;
  const url = new URL("/search", base);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", kind === "news" ? "news" : "general");
  url.searchParams.set("safesearch", "1");
  if (time !== "any") url.searchParams.set("time_range", time);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { title?: string; url?: string; content?: string; publishedDate?: string | null }[];
      unresponsive_engines?: unknown[];
    };
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const r of data.results ?? []) {
      if (!r.url || !/^https?:\/\//.test(r.url) || seen.has(r.url)) continue;
      seen.add(r.url);
      hits.push({
        title: plain(r.title ?? "") || hostOf(r.url),
        url: r.url,
        snippet: plain(r.content ?? "").slice(0, 320),
        source: hostOf(r.url),
        ...(r.publishedDate ? { age: r.publishedDate.slice(0, 10) } : {}),
      });
      if (hits.length === 8) break;
    }
    return { hits, blocked: data.unresponsive_engines?.length ?? 0 };
  } catch {
    return null;
  }
}

/** Whether the SearXNG service answers (for the Settings status). */
export async function searchServiceReady(): Promise<boolean> {
  const base = env().SEARXNG_URL;
  if (!base || base === "off") return false;
  try {
    const res = await fetch(new URL("/healthz", base), { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function runSearch(query: string, kind: "web" | "news", time: string): Promise<SearchOut> {
  const key = `${kind}|${time}|${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const fromSearx = await searxng(query, kind, time);
  if (fromSearx?.hits.length) {
    const value: SearchOut = { ok: true, query, kind, results: fromSearx.hits };
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    return value;
  }

  // SearXNG answered but found nothing: DuckDuckGo gets one quick try, and if it's turning
  // searches away that's still just "no results", not an outage. It's capped so an empty search
  // doesn't also sit through DuckDuckGo's queue and timeouts.
  if (fromSearx) {
    try {
      const value = await Promise.race([
        duckSearch(query, kind, time),
        new Promise<null>((r) => setTimeout(() => r(null), DUCK_FALLBACK_MS)),
      ]);
      if (value?.ok && value.results.length) return value;
    } catch {}
    // An empty answer because engines turned the search away says nothing about the topic, and
    // the model must not read it as "this doesn't exist".
    const note = fromSearx.blocked
      ? "No results: the search engines turned this search away (rate limits), so this says nothing about whether it exists. Try again in a minute, or read a page you already know with read_webpage."
      : "No results. Try a shorter, more general query (3 to 6 words).";
    return { ok: true, query, kind, results: [], note };
  }

  return duckSearch(query, kind, time);
}

/** DuckDuckGo directly, spaced out because it turns away bursts. */
async function duckSearch(query: string, kind: "web" | "news", time: string): Promise<SearchOut> {
  const key = `${kind}|${time}|${query.toLowerCase()}`;
  await waitTurn();
  let results: SearchHit[];
  if (kind === "news") {
    const r = await searchNews(query, { safeSearch: SafeSearchType.MODERATE, time: TIME[time] }, HTTP);
    results = r.results.slice(0, 8).map((n) => ({
      title: plain(n.title),
      url: n.url,
      snippet: plain(n.excerpt).slice(0, 320),
      source: n.syndicate,
      age: n.relativeTime,
    }));
  } else {
    const r = await search(query, { safeSearch: SafeSearchType.MODERATE, time: TIME[time] }, HTTP);
    results = r.results.slice(0, 8).map((x) => ({ title: plain(x.title), url: x.url, snippet: plain(x.description).slice(0, 320), source: x.hostname }));
  }
  const value: SearchOut = { ok: true, query, kind, results };
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return value;
}

export function webTools(_ctx: RunContext) {
  return {
    web_search: tool({
      description:
        "Search the web. Returns titles, links and short snippets. Use it for anything current, or anything you aren't sure of; then read the best results with read_webpage before answering, and name the pages you used.",
      inputSchema: z.object({
        query: z.string().min(1).max(300).describe("What to search for, in the words a page would use"),
        kind: z.enum(["web", "news"]).default("web").describe("'news' for recent articles"),
        time: z.enum(["any", "day", "week", "month", "year"]).default("any").describe("Only results from this period"),
      }),
      execute: async ({ query, kind, time }): Promise<SearchOut> => {
        try {
          return await runSearch(query.trim(), kind, time);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Search failed";
          if (/anomaly|too quickly/i.test(msg)) {
            return {
              ok: false,
              error: "Search is unavailable right now (the search service isn't answering and DuckDuckGo is turning searches away). Read a page you already know with read_webpage, or use your browser.",
            };
          }
          return { ok: false, error: msg.slice(0, 200) };
        }
      },
    }),

    read_webpage: tool({
      description:
        "Fetch a public web page and return its readable text. Use for reading a search result, an article, docs or a page the user linked.",
      inputSchema: z.object({
        url: z.string().url().describe("Full https URL"),
        offset: z.number().int().min(0).optional().describe("Character offset to continue reading a long page"),
      }),
      execute: async ({ url, offset = 0 }) => {
        try {
          const { res, body, finalUrl } = await safeFetch(url);
          const type = res.headers.get("content-type") ?? "";
          if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
          if (type.includes("pdf")) {
            const { extractText, getDocumentProxy } = await import("unpdf");
            const pdf = await getDocumentProxy(new Uint8Array(body));
            const { text } = await extractText(pdf, { mergePages: true });
            const full = String(text);
            return { ok: true, url: finalUrl, title: "PDF", text: full.slice(offset, offset + 12000), total: full.length };
          }
          const { title, text } = type.includes("html") ? htmlToText(body.toString("utf8")) : { title: "", text: body.toString("utf8") };
          return { ok: true, url: finalUrl, title, text: text.slice(offset, offset + 12000), total: text.length };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Fetch failed" };
        }
      },
    }),
  };
}
